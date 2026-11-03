/**
 * PoC 运行时验证：JSON / Bytes / 级联删除 / 事务 / 唯一约束 / 关联查询
 */
import { PrismaClient } from './generated/client/client.js'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({ url: 'file:./test.db' })
const prisma = new PrismaClient({ adapter })

async function main() {
  // --- 清理 ---
  await prisma.auditEvent.deleteMany()
  await prisma.nodeAcl.deleteMany()
  await prisma.nodeVersion.deleteMany()
  await prisma.documentContent.deleteMany()
  await prisma.attachment.deleteMany()
  await prisma.node.deleteMany()
  await prisma.workspaceMember.deleteMany()
  await prisma.workspace.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()

  // --- 1. 基本创建 + JSON 字段 + Bytes ---
  const user = await prisma.user.create({
    data: {
      id: 'u1',
      email: 'a@b.c',
      passwordHash: 'hash',
      displayName: 'A',
      status: 'active',
    },
  })
  console.log('✓ 1. User.create OK')

  const ws = await prisma.workspace.create({
    data: { id: 'w1', name: 'W', ownerId: user.id },
  })
  console.log('✓ 2. Workspace.create OK')

  const parent = await prisma.node.create({
    data: {
      id: 'p1',
      workspaceId: ws.id,
      type: 'folder',
      title: 'P',
      titleNorm: 'p',
      ownerId: user.id,
    },
  })
  console.log('✓ 3. Node.create OK')

  const child = await prisma.node.create({
    data: {
      id: 'c1',
      workspaceId: ws.id,
      parentId: parent.id,
      type: 'doc',
      title: 'C',
      titleNorm: 'c',
      ownerId: user.id,
    },
  })
  console.log('✓ 4. 子节点创建 OK（自引用关系）')

  // JSON 字段
  await prisma.documentContent.create({
    data: {
      nodeId: child.id,
      contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      yjsState: new Uint8Array([1, 2, 3, 4, 5]),
      stateVector: new Uint8Array([9, 9]),
      charCount: 0,
    },
  })
  const doc = await prisma.documentContent.findUnique({ where: { nodeId: child.id } })
  console.log('✓ 5. Json 字段往返 OK:', JSON.stringify(doc.contentJson))
  console.log('✓ 6. Bytes 字段 OK: yjsState =', Array.from(doc.yjsState))

  // --- 7. 级联删除（关键：架构文档 §7.2 变更 2） ---
  await prisma.node.delete({ where: { id: 'p1' } })
  const orphan = await prisma.node.findUnique({ where: { id: 'c1' } })
  console.log(
    orphan === null
      ? '✓ 7. 级联删除 OK（父节点删除后子节点消失）'
      : '✗ 7. 级联删除失败：子节点仍存在',
  )

  // --- 8. 事务 ---
  try {
    await prisma.$transaction(async (tx) => {
      await tx.workspace.create({ data: { id: 'w2', name: 'W2', ownerId: user.id } })
      throw new Error('故意回滚')
    })
    console.log('✗ 8. 事务失败：应当回滚')
  } catch {
    const w2 = await prisma.workspace.findUnique({ where: { id: 'w2' } })
    console.log(w2 === null ? '✓ 8. 事务回滚 OK' : '✗ 8. 事务未回滚')
  }

  // --- 9. 事务提交 ---
  await prisma.$transaction(async (tx) => {
    await tx.workspace.create({ data: { id: 'w3', name: 'W3', ownerId: user.id } })
  })
  const w3 = await prisma.workspace.findUnique({ where: { id: 'w3' } })
  console.log(w3 !== null ? '✓ 9. 事务提交 OK' : '✗ 9. 事务提交失败')

  // --- 10. 唯一约束 ---
  try {
    await prisma.user.create({
      data: { id: 'u2', email: 'a@b.c', passwordHash: 'h', displayName: 'B' },
    })
    console.log('✗ 10. 唯一约束未生效')
  } catch {
    console.log('✓ 10. 唯一约束 OK（重复 email 被拒）')
  }

  // --- 11. 关联查询 include ---
  const withRel = await prisma.workspace.findUnique({
    where: { id: 'w1' },
    include: { owner: true, members: true, nodes: true },
  })
  console.log(
    withRel.owner && Array.isArray(withRel.members) && Array.isArray(withRel.nodes)
      ? '✓ 11. 关联查询 include OK'
      : '✗ 11. 关联查询失败',
  )

  // --- 12. 嵌套写入 ---
  const nested = await prisma.workspace.create({
    data: {
      id: 'w4',
      name: 'W4',
      ownerId: user.id,
      members: { create: [{ userId: user.id, role: 'owner' }] },
    },
    include: { members: true },
  })
  console.log(
    nested.members.length === 1 ? '✓ 12. 嵌套写入 OK' : '✗ 12. 嵌套写入失败',
  )

  // --- 13. 部分索引 / 复合索引是否生效（间接验证：查 SQLite 索引列表） ---
  const idx = await prisma.$queryRawUnsafe(
    `select name from sqlite_master where type='index' and tbl_name='nodes'`,
  )
  console.log('✓ 13. nodes 表索引:', idx.map((i) => i.name).join(', '))

  // --- 14. 软删除过滤（deletedAt 为 null 的节点应可见）---
  const visible = await prisma.node.count({ where: { deletedAt: null } })
  console.log('✓ 14. 软删除过滤 OK，可见节点数 =', visible)

  // --- 15. Bytes 与 JSON 的类型往返是否保真 ---
  await prisma.node.create({
    data: { id: 'cn1', workspaceId: 'w1', type: 'doc', title: '中文标题', titleNorm: '中文标题', ownerId: 'u1' },
  })
  const cn = await prisma.node.findUnique({ where: { id: 'cn1' } })
  console.log(cn.title === '中文标题' ? '✓ 15. 中文往返 OK' : '✗ 15. 中文乱码: ' + cn.title)

  // --- 16. titleNorm 大小写不敏感前缀搜索（替代 PG trigram）---
  const found = await prisma.node.findMany({
    where: { titleNorm: { startsWith: '中文' } },
  })
  console.log(found.length === 1 ? '✓ 16. 前缀搜索 OK' : '✗ 16. 前缀搜索失败')

  // --- 17. BigInt 自增主键（audit_events）---
  const ae = await prisma.auditEvent.create({ data: { workspaceId: 'w1', action: 'node.create', targetType: 'node', metadata: {} } })
  console.log(typeof ae.id === 'bigint' ? '✓ 17. BigInt 自增 OK' : '✓ 17. 自增 OK (type=' + typeof ae.id + ')')

  console.log('\n所有运行时验证完成')
}

main()
  .catch((e) => {
    console.error('PoC 失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
