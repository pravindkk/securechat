import { prisma } from '../config/database.js';
import { sanitizeUser } from '../utils/helpers.js';
import { NotFoundError } from '../middleware/errorHandler.js';

export class UserService {
  async getUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return sanitizeUser(user);
  }

  async searchUsers(query: string, excludeUserId?: string, limit: number = 20) {
    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
            ],
          },
          excludeUserId ? { id: { not: excludeUserId } } : {},
        ],
      },
      take: limit,
      orderBy: { name: 'asc' },
    });

    return users.map(sanitizeUser);
  }

  async updateUser(
    userId: string,
    data: { name?: string; photoUrl?: string | null }
  ) {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
    });

    return sanitizeUser(user);
  }

  async getUserPublicKey(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { publicKey: true },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user.publicKey;
  }

  async getMultipleUsersPublicKeys(userIds: string[]): Promise<Map<string, string>> {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, publicKey: true },
    });

    const keyMap = new Map<string, string>();
    users.forEach((u) => keyMap.set(u.id, u.publicKey));
    return keyMap;
  }

  async deleteUser(userId: string): Promise<void> {
    await prisma.user.delete({
      where: { id: userId },
    });
  }

  async getDevices(userId: string) {
    return prisma.device.findMany({
      where: { userId },
      orderBy: { lastActive: 'desc' },
    });
  }

  async removeDevice(userId: string, deviceId: string): Promise<void> {
    await prisma.device.deleteMany({
      where: {
        id: deviceId,
        userId,
      },
    });
  }
}

export const userService = new UserService();
export default userService;
