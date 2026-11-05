/**
 * 免密身份（设备指纹）。
 *
 * "简版"形态：用户打开页面只输入一个名字，客户端把浏览器指纹哈希后当身份 key
 * 发给服务端，服务端由这个 key 派生出稳定账号。同一浏览器再次打开自动回到同一身份，
 * 不需要登录流程。
 *
 * 这里刻意保持**纯确定性**：同一个 deviceKey 永远映射到同一个 userId 与同一个后台地址，
 * 因此不必新增"设备表"，也不需要额外的唯一约束——账号本身就是映射结果。
 *
 * 安全边界（必须诚实）：
 *   - 知道他人 deviceKey 的人可以冒充他。指纹可伪造、可导出，这是免密形态的固有代价，
 *     只适合内网/试用环境；开关 DEVICE_IDENTITY 默认关闭，生产要显式打开才生效。
 *   - 邮箱是内部的、不对用户展示的占位地址（`<key前缀>@device.weshare.local`），
 *     故意落在不可路由的 .local 域，任何邮件流程都不会误发。
 *   - deviceKey 只存 64 位 hex（见 shared 的 DeviceKeySchema），日志里要脱敏。
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Repositories } from '@weshare/db'
import type { CurrentUser } from '@weshare/shared'
import { AppError } from '../http/errors.js'
import { toCurrentUser } from '../http/auth-routes.js'

/** 占位邮箱域名：不可路由，避免误发邮件。 */
const DEVICE_EMAIL_DOMAIN = 'device.weshare.local'

/** 新设备首次进入时自动建的空间名。 */
function defaultWorkspaceName(displayName: string): string {
  return `${displayName} 的空间`
}

/** 由 deviceKey 派生账号 id：稳定、可预测，且不需要额外唯一约束。 */
function deviceUserId(deviceKey: string): string {
  const digest = createHash('sha256').update(`weshare-device-user:${deviceKey}`).digest('hex')
  return `du_${digest.slice(0, 32)}`
}

/** 由 deviceKey 派生占位邮箱（用户不可见，仅用于满足 email 唯一约束与内部查找）。 */
function deviceEmail(deviceKey: string): string {
  return `${deviceKey.slice(0, 32)}@${DEVICE_EMAIL_DOMAIN}`
}

export interface DeviceIdentityResult {
  user: CurrentUser
  created: boolean
}

export class IdentityService {
  constructor(private readonly repos: Repositories) {}

  /**
   * 用设备标识取（或建立）身份。
   *
   * @param displayName 用户当次输入的名字。已存在的身份会被更新为这个名字——
   *   用户重新输入名字通常意味着想换个显示名，而在简版里没有别的改名入口。
   */
  async establish(deviceKey: string, displayName: string): Promise<DeviceIdentityResult> {
    const emailLower = deviceEmail(deviceKey)
    const existing = await this.repos.users.findByEmailLower(emailLower)

    if (existing) {
      if (existing.status === 'disabled') {
        // 禁用是管理侧的明确决定，不能被"重新输入名字"绕过
        throw new AppError('FORBIDDEN', '账号已被禁用')
      }
      const renamed =
        existing.displayName === displayName
          ? existing
          : await this.repos.users.updateDisplayName(existing.id, displayName)
      await this.repos.users.touchLastLogin(renamed.id, new Date())
      return { user: toCurrentUser(renamed), created: false }
    }

    const user = await this.createIdentities(deviceKey, displayName)
    return { user: toCurrentUser(user), created: true }
  }

  /**
   * 首次进入：建账号 + 建一个默认空间 + 一篇欢迎文档。
   *
   * 新用户进来就落到"能用"的状态，而不是先看一个空页面再被要求建空间——
   * 简版的产品主张就是"打开即用"。
   */
  private async createIdentities(deviceKey: string, displayName: string) {
    const userId = deviceUserId(deviceKey)

    const user = await this.repos.users.create({
      id: userId,
      email: deviceEmail(deviceKey),
      // 免密身份没有密码。给一个不可校验的哈希，而不是空串——
      // 登录接口的哑哈希比对对任何输入都会失败，等于这个账号无法用密码登录。
      passwordHash: '!device-identity',
      displayName,
    })

    const workspace = await this.repos.workspaces.create({
      id: randomUUID(),
      name: defaultWorkspaceName(displayName),
      ownerId: user.id,
      defaultRole: 'edit',
    })

    await this.repos.nodes.createDocument({
      id: randomUUID(),
      workspaceId: workspace.id,
      parentId: null,
      ownerId: user.id,
      type: 'doc',
      title: '欢迎使用 weShare',
      visibility: 'workspace',
      // 必须走 createDocument：doc 节点与正文字段是一个聚合，缺正文的文档打不开
      contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    })

    await this.repos.users.touchLastLogin(user.id, new Date())
    return user
  }
}
