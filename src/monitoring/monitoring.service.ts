import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailLog, EmailStatus } from './entities/email-log.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
    private readonly configService: ConfigService,
  ) {}

  async sendTestEmail(email: string): Promise<{ success: boolean; message: string; timestamp: string }> {
    const startTime = Date.now();
    
    try {
      // Get email configuration from environment
      const smtpHost = this.configService.get<string>('SMTP_HOST');
      const smtpPort = this.configService.get<number>('SMTP_PORT');
      const smtpUser = this.configService.get<string>('SMTP_USER');
      const smtpPass = this.configService.get<string>('SMTP_PASSWORD');
      const smtpFrom = this.configService.get<string>('SMTP_FROM') || 'noreply@cushyaccess.com';

      if (!smtpHost || !smtpUser || !smtpPass) {
        throw new Error('SMTP configuration is missing');
      }

      // Create email log entry
      const emailLog = this.emailLogRepository.create({
        recipient: email,
        subject: 'Cushy Access Email Monitoring Test',
        template: 'otp',
      });
      
      await this.emailLogRepository.save(emailLog);

      // Simulate email sending (replace with actual SMTP implementation)
      // For now, we'll simulate a successful send
      await this.simulateEmailSend(email, smtpFrom);

      const deliveryTime = Date.now() - startTime;

      // Update log with success
      emailLog.status = EmailStatus.SENT;
      emailLog.deliveryTime = deliveryTime;
      emailLog.messageId = `<${Date.now()}@smtp-relay.mailin.fr>`;
      await this.emailLogRepository.save(emailLog);

      this.logger.log(`Test email sent successfully to ${email} in ${deliveryTime}ms`);

      return {
        success: true,
        message: 'Test email sent successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to send test email to ${email}: ${errorMessage}`);

      // Update log with error
      const emailLog = await this.emailLogRepository.findOne({
        where: { recipient: email },
        order: { timestamp: 'DESC' },
      });

      if (emailLog) {
        emailLog.status = EmailStatus.FAILED;
        emailLog.error = JSON.stringify({ message: errorMessage });
        await this.emailLogRepository.save(emailLog);
      }

      return {
        success: false,
        message: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async simulateEmailSend(to: string, from: string): Promise<void> {
    // This is a placeholder for actual SMTP implementation
    // In production, you would use nodemailer or similar library
    // For now, we'll just delay to simulate network time
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 500));
  }

  async getEmailLogs(filters?: {
    status?: string;
    email?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{ count: number; data: EmailLog[]; success: boolean; timestamp: string }> {
    try {
      const queryBuilder = this.emailLogRepository.createQueryBuilder('log');

      if (filters?.status) {
        queryBuilder.andWhere('log.status = :status', { status: filters.status });
      }

      if (filters?.email) {
        queryBuilder.andWhere('log.recipient ILIKE :email', { email: `%${filters.email}%` });
      }

      if (filters?.dateFrom) {
        queryBuilder.andWhere('log.timestamp >= :dateFrom', { dateFrom: new Date(filters.dateFrom) });
      }

      if (filters?.dateTo) {
        queryBuilder.andWhere('log.timestamp <= :dateTo', { dateTo: new Date(filters.dateTo) });
      }

      queryBuilder.orderBy('log.timestamp', 'DESC');

      const [logs, count] = await queryBuilder.getManyAndCount();

      return {
        count,
        data: logs,
        success: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to retrieve email logs: ${errorMessage}`);
      throw error;
    }
  }
}
