import { describe, expect, it } from 'vitest'
import {
  can,
  effectiveRole,
  type AuthzAclEntry,
  type AuthzContext,
  type AuthzNode,
} from '../src/index'

const USER = 'user-1'
const OTHER = 'user-2'

/**
 * 默认节点：**不是**当前用户的**。
 *
 * 夹具默认让 owner 是别人，否则 owner 分支（base = manage）会掩盖
 * 被测逻辑——默认角色、cap 截断、ACL 合并这些用例全部会假绿。
 * 需要验证 owner 语义时显式传 ownerId。
 */
function node(overrides: Partial<AuthzNode> = {}): AuthzNode {
  return {
    id: 'node-1',
    workspaceId: 'ws-1',
    ownerId: OTHER,
    visibility: 'workspace',
    deletedAt: null,
    ...overrides,
  }
}

function ctx(overrides: Partial<AuthzContext> = {}): AuthzContext {
  return {
    userId: USER,
    workspaceRole: 'member',
    workspaceDefaultRole: 'edit',
    aclEntries: [],
    ...overrides,
  }
}

function allow(subjectId: string, role: AuthzAclEntry['role']): AuthzAclEntry {
  return { subjectType: 'user', subjectId, role, effect: 'allow' }
}

function deny(subjectId: string, role: AuthzAclEntry['role']): AuthzAclEntry {
  return { subjectType: 'user', subjectId, role, effect: 'deny' }
}

describe('effectiveRole —— 基础权限', () => {
  it('节点 owner 恒为 manage', () => {
    expect(effectiveRole(ctx(), node({ ownerId: USER }))).toBe('manage')
  })

  it('workspace 可见的文档取空间默认角色', () => {
    expect(effectiveRole(ctx({ workspaceDefaultRole: 'edit' }), node())).toBe('edit')
    expect(effectiveRole(ctx({ workspaceDefaultRole: 'view' }), node())).toBe('view')
  })

  it('private 且非 owner 无授权时拒绝', () => {
    expect(effectiveRole(ctx(), node({ ownerId: OTHER, visibility: 'private' }))).toBeNull()
  })

  it('private 但被显式授权则按授权角色', () => {
    const c = ctx({ aclEntries: [allow(USER, 'edit')] })
    expect(effectiveRole(c, node({ ownerId: OTHER, visibility: 'private' }))).toBe('edit')
  })

  it('非空间成员一律拒绝', () => {
    expect(effectiveRole(ctx({ workspaceRole: null }), node())).toBeNull()
  })
})

describe('effectiveRole —— 空间角色封顶（cap）', () => {
  it('viewer 恒被截断为 view', () => {
    const c = ctx({ workspaceRole: 'viewer', aclEntries: [allow(USER, 'manage')] })
    expect(effectiveRole(c, node())).toBe('view')
  })

  it('owner/admin 不封顶——可以被授予 manage', () => {
    const c = ctx({ workspaceRole: 'owner', aclEntries: [allow(USER, 'manage')] })
    expect(effectiveRole(c, node())).toBe('manage')
    const c2 = ctx({ workspaceRole: 'admin', aclEntries: [allow(USER, 'manage')] })
    expect(effectiveRole(c2, node())).toBe('manage')
  })

  it('空间 owner/admin 不会自动获得他人私密文档的权限', () => {
    // 空间角色是上限而非授予：他人私密文档对空间 owner 依然无权
    const c = ctx({ workspaceRole: 'owner' })
    expect(effectiveRole(c, node({ visibility: 'private' }))).toBeNull()
  })

  it('member 不封顶，ACL 授予 manage 即为 manage', () => {
    const c = ctx({ workspaceRole: 'member', aclEntries: [allow(USER, 'manage')] })
    expect(effectiveRole(c, node())).toBe('manage')
  })

  it('先算权限再截断——owner 身份不因 cap 被降级', () => {
    // 节点 owner 且空间角色为 viewer：仍是 view（cap 生效），不是 manage
    const c = ctx({ workspaceRole: 'viewer' })
    expect(effectiveRole(c, node({ ownerId: USER }))).toBe('view')
  })
})

describe('effectiveRole —— ACL allow 抬升', () => {
  it('多条 allow 取最高角色', () => {
    const c = ctx({
      aclEntries: [allow(USER, 'view'), allow(USER, 'edit'), allow(USER, 'comment')],
    })
    expect(effectiveRole(c, node({ ownerId: OTHER, visibility: 'private' }))).toBe('edit')
  })

  it('allow 可突破空间默认角色（member 上限内）', () => {
    const c = ctx({ workspaceDefaultRole: 'view', aclEntries: [allow(USER, 'edit')] })
    expect(effectiveRole(c, node({ ownerId: OTHER }))).toBe('edit')
  })
})

describe('effectiveRole —— ACL deny 降权（优先于 allow）', () => {
  it('deny 压低 allow 的结果', () => {
    const c = ctx({
      workspaceDefaultRole: 'edit',
      aclEntries: [allow(USER, 'manage'), deny(USER, 'view')],
    })
    expect(effectiveRole(c, node({ ownerId: OTHER }))).toBe('view')
  })

  it('deny 也能压低节点 owner 的 manage', () => {
    const c = ctx({ aclEntries: [deny(USER, 'view')] })
    expect(effectiveRole(c, node({ ownerId: USER }))).toBe('view')
  })

  it('多条 deny 取最低角色', () => {
    const c = ctx({
      aclEntries: [deny(USER, 'edit'), deny(USER, 'view'), allow(USER, 'manage')],
    })
    expect(effectiveRole(c, node({ ownerId: OTHER }))).toBe('view')
  })

  it('deny 仍受空间角色封顶约束', () => {
    const c = ctx({ workspaceRole: 'viewer', aclEntries: [deny(USER, 'edit')] })
    expect(effectiveRole(c, node({ ownerId: OTHER }))).toBe('view')
  })
})

describe('effectiveRole —— 回收站分支', () => {
  const deleted = node({ deletedAt: new Date() })

  it('已删除节点：manage 可读', () => {
    const c = ctx({ workspaceRole: 'owner', aclEntries: [allow(USER, 'manage')] })
    expect(effectiveRole(c, deleted, 'read')).toBe('manage')
  })

  it('已删除节点：非 manage 不可读', () => {
    const c = ctx({ workspaceRole: 'member', workspaceDefaultRole: 'edit' })
    expect(effectiveRole(c, deleted, 'read')).toBeNull()
  })

  it('已删除节点：manage 可还原', () => {
    const c = ctx({ workspaceRole: 'owner', aclEntries: [allow(USER, 'manage')] })
    expect(effectiveRole(c, deleted, 'restore')).toBe('manage')
  })

  it('已删除节点：非 manage 不可还原', () => {
    const c = ctx({ workspaceRole: 'member' })
    expect(effectiveRole(c, deleted, 'restore')).toBeNull()
  })

  it('已删除节点：purge 仅空间 owner/admin', () => {
    expect(effectiveRole(ctx({ workspaceRole: 'owner' }), deleted, 'purge')).toBe('manage')
    expect(effectiveRole(ctx({ workspaceRole: 'admin' }), deleted, 'purge')).toBe('manage')
    expect(effectiveRole(ctx({ workspaceRole: 'member' }), deleted, 'purge')).toBeNull()
    expect(effectiveRole(ctx({ workspaceRole: 'viewer' }), deleted, 'purge')).toBeNull()
  })
})

describe('can —— 能力判定', () => {
  it('角色不足时拒绝', () => {
    const c = ctx({ workspaceRole: 'member', workspaceDefaultRole: 'view' })
    expect(can(c, node(), 'edit')).toBe(false)
    expect(can(c, node(), 'view')).toBe(true)
  })

  it('拒绝时不会因 can 的参数顺序而反转', () => {
    const c = ctx({ workspaceRole: 'member', workspaceDefaultRole: 'comment' })
    expect(can(c, node(), 'comment')).toBe(true)
    expect(can(c, node(), 'edit')).toBe(false)
  })
})
