import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CushyAIChatRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsBoolean()
  newSession?: boolean = false;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  chatId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientMessageId?: string;
}

export class CreateAiChatDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export class RecordAiOrderResultDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  orderId: string;
}

export class AiKnowledgeArticleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(20_000)
  content: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateAiKnowledgeArticleDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(20_000)
  content?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
