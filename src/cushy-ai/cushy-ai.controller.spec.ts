import { ADMIN_ROLE_KEY } from '../auth/service/admin-roles.decorator';
import { ROLE_KEY } from '../auth/service/roles.decorator';
import { AdminRole } from '../users/model/admin-roles.enum';
import { UserRoles } from '../users/model/user-roles.enum';
import { CushyAIController } from './cushy-ai.controller';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

describe('CushyAIController knowledge authorization', () => {
  const methods = [
    'listKnowledge',
    'createKnowledge',
    'updateKnowledge',
    'patchKnowledge',
    'deleteKnowledge',
  ] as const;

  it.each(methods)('%s is restricted to Super Admin users', (method) => {
    const handler = CushyAIController.prototype[method];
    expect(Reflect.getMetadata(ROLE_KEY, handler)).toEqual([UserRoles.ADMIN]);
    expect(Reflect.getMetadata(ADMIN_ROLE_KEY, handler)).toEqual([
      AdminRole.SUPER_ADMIN,
    ]);
  });

  it('restricts customer chat and history routes at controller level', () => {
    expect(Reflect.getMetadata(ROLE_KEY, CushyAIController)).toEqual([
      UserRoles.CUSTOMER,
    ]);
  });

  it.each([
    ['listChats', 'chats', RequestMethod.GET],
    ['getChat', 'chats/:chatId', RequestMethod.GET],
    ['deleteChat', 'chats/:chatId', RequestMethod.DELETE],
    ['recordOrderResult', 'chats/:chatId/order-result', RequestMethod.POST],
    ['listKnowledge', 'knowledge', RequestMethod.GET],
    ['createKnowledge', 'knowledge', RequestMethod.POST],
  ] as const)(
    '%s exposes %s with the expected HTTP method',
    (method, path, verb) => {
      const handler = CushyAIController.prototype[method];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
    },
  );
});
