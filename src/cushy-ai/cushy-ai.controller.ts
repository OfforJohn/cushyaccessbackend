import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  Put,
  Patch,
} from '@nestjs/common';
import { CushyAIService } from './cushy-ai.service';
import { ConversationService } from './conversation.service';
import {
  CreateAiChatDto,
  AiKnowledgeArticleDto,
  CushyAIChatRequestDto,
  RecordAiOrderResultDto,
  UpdateAiKnowledgeArticleDto,
} from './dto/cushy-ai.dto';
import { CushyAiKnowledgeService } from './cushy-ai-knowledge.service';
import { Permit } from '../auth/service/roles.decorator';
import { UserRoles } from '../users/model/user-roles.enum';
import { PermitAdminRoles } from '../auth/service/admin-roles.decorator';
import { AdminRole } from '../users/model/admin-roles.enum';

@Controller('api/v1/cushy-ai')
@Permit([UserRoles.CUSTOMER])
export class CushyAIController {
  constructor(
    private cushyAIService: CushyAIService,
    private conversationService: ConversationService,
    private knowledgeService: CushyAiKnowledgeService,
  ) {}

  @Post('chat')
  async chat(@Body() request: CushyAIChatRequestDto) {
    return await this.cushyAIService.askCushyAI(request.message, {
      newSession: request.newSession,
      chatId: request.chatId,
      clientMessageId: request.clientMessageId,
    });
  }

  @Post('chats')
  async createChat(@Body() request: CreateAiChatDto) {
    return this.conversationService.createChat(request.title);
  }

  @Get('chats')
  async listChats() {
    return this.conversationService.listChats();
  }

  @Get('chats/:chatId')
  async getChat(@Param('chatId') chatId: string) {
    return this.conversationService.getChat(chatId);
  }

  @Delete('chats/:chatId')
  async deleteChat(@Param('chatId') chatId: string) {
    return this.conversationService.deleteChat(chatId);
  }

  @Post('chats/:chatId/order-result')
  async recordOrderResult(
    @Param('chatId') chatId: string,
    @Body() request: RecordAiOrderResultDto,
  ) {
    return this.cushyAIService.recordOrderResult(chatId, request.orderId);
  }

  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  @Get('knowledge')
  async listKnowledge() {
    return this.knowledgeService.list();
  }

  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  @Post('knowledge')
  async createKnowledge(@Body() request: AiKnowledgeArticleDto) {
    return this.knowledgeService.create(request);
  }

  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  @Put('knowledge/:id')
  async updateKnowledge(
    @Param('id') id: string,
    @Body() request: AiKnowledgeArticleDto,
  ) {
    return this.knowledgeService.update(id, request);
  }

  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  @Patch('knowledge/:id')
  async patchKnowledge(
    @Param('id') id: string,
    @Body() request: UpdateAiKnowledgeArticleDto,
  ) {
    return this.knowledgeService.update(id, request);
  }

  @Permit([UserRoles.ADMIN])
  @PermitAdminRoles(AdminRole.SUPER_ADMIN)
  @Delete('knowledge/:id')
  async deleteKnowledge(@Param('id') id: string) {
    return this.knowledgeService.delete(id);
  }

  // Legacy history endpoint retained for older OTA channels only.
  @Get('my-conversations')
  async getConversations() {
    return await this.conversationService.getUserConversations();
  }
}
