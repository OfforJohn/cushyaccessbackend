import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CushyAIController } from './cushy-ai.controller';
import { CushyAIService } from './cushy-ai.service';
import { ConversationService } from './conversation.service';
import { Conversation } from './model/entity/conversation.entity';
import { CommonModule } from '../common/common.module';
import { UsersModule } from '../users/users.module';
import { AiChat } from './model/entity/ai-chat.entity';
import { AiChatMessage } from './model/entity/ai-chat-message.entity';
import { StoresModule } from '../stores/stores.module';
import { OrderModule } from '../orders/orders.module';
import { WalletModule } from '../wallet/wallet.module';
import { Orders } from '../orders/model/order.entity';
import { CushyAiToolsService } from './cushy-ai-tools.service';
import { AiKnowledgeArticle } from './model/entity/ai-knowledge-article.entity';
import { CushyAiKnowledgeService } from './cushy-ai-knowledge.service';
import { CushyAiProviderModule } from './cushy-ai-provider.module';
import { AiDiagnosticService } from './ai-diagnostic.service';
import { AiDiagnosticController } from './ai-diagnostic.controller';
import { AiUsageMetric } from './model/entity/ai-usage-metric.entity';
import { AiUsageTrackingService } from './services/ai-usage-tracking.service';
import { AiTestingService } from './services/ai-testing.service';

@Module({
  imports: [
    CushyAiProviderModule,
    CommonModule,
    UsersModule,
    StoresModule,
    OrderModule,
    WalletModule,
    TypeOrmModule.forFeature([
      Conversation,
      AiChat,
      AiChatMessage,
      AiKnowledgeArticle,
      Orders,
      AiUsageMetric,
    ]),
  ],
  providers: [
    CushyAIService,
    ConversationService,
    CushyAiToolsService,
    CushyAiKnowledgeService,
    AiDiagnosticService,
    AiUsageTrackingService,
    AiTestingService,
  ],
  controllers: [CushyAIController, AiDiagnosticController],
  exports: [CushyAIService, ConversationService],
})
export class CushyAIModule {}
