import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

import SibApiV3Sdk from 'sib-api-v3-sdk';
import { OperationalMetric } from '../monitoring/entities/operational-metric.entity';

@Injectable()
export class MailSenderService {
  private readonly logger = new Logger(MailSenderService.name);
  private readonly apiInstance: typeof SibApiV3Sdk.TransactionalEmailsApi;
  private readonly configService: ConfigService;
  private readonly templateCache = new Map<
    string,
    Handlebars.TemplateDelegate
  >();

  constructor(
    @InjectRepository(OperationalMetric)
    private operationalMetricRepository: Repository<OperationalMetric>,
  ) {
    this.configService = new ConfigService();
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKey = defaultClient.authentications['api-key'];
    
    // Clean and validate the API key
    const rawApiKey = this.configService.get<string>('BREVO_API_KEY') || process.env.BREVO_API_KEY;
    const cleanedApiKey = rawApiKey?.trim();
    
    if (!cleanedApiKey) {
      this.logger.error('BREVO_API_KEY is not configured');
    } else {
      this.logger.debug(`Brevo API key configured (length: ${cleanedApiKey.length})`);
      apiKey.apiKey = cleanedApiKey;
    }
    
    this.apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
    this.registerHandlebarsHelpers();
  }

  private registerHandlebarsHelpers() {
    Handlebars.registerHelper('increment', function (index: number) {
      return index + 1;
    });

    // You can register other helpers here too
    Handlebars.registerHelper('formatDate', function (date: Date) {
      return new Date(date).toLocaleDateString();
    });

    Handlebars.registerHelper('eq', function (a: any, b: any) {
      return a === b;
    });
  }

  private getTemplate(template: string): Handlebars.TemplateDelegate {
    const cached = this.templateCache.get(template);
    if (cached) return cached;
    const templatePath = path.join(
      process.cwd(),
      'templates',
      `${template}.hbs`,
    );
    const compiled = Handlebars.compile(fs.readFileSync(templatePath, 'utf8'));
    this.templateCache.set(template, compiled);
    return compiled;
  }

  async sendMail({
    recipient,
    subject,
    content,
    template,
    bcc,
  }: {
    recipient: string;
    subject: string;
    content: any;
    template: string;
    bcc?: string | string[];
  }) {
    // 1️⃣ Load template file (.hbs)
    const html = this.getTemplate(template)(content);

    // 2️⃣ Compile template with Handlebars
    // 3️⃣ Build the Brevo API request
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    const fromEmail = this.configService.get<string>('MAIL_FROM');
    const username = this.configService.get<string>('MAIL_USERNAME');
    sendSmtpEmail.sender = {
      name: username,
      email: fromEmail,
    };
    sendSmtpEmail.to = [{ email: recipient }];
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = html;

    if (bcc) {
      const bccList = Array.isArray(bcc)
        ? bcc.map((email) => ({ email }))
        : [{ email: bcc }];

      sendSmtpEmail.bcc = bccList;
    }

    try {
      const startTime = Date.now();
      const response = await this.apiInstance.sendTransacEmail(sendSmtpEmail);
      const deliveryTime = Date.now() - startTime;
      
      this.logger.log(`Email sent successfully: ${JSON.stringify(response)}`);
      
      // Track successful email delivery
      await this.trackEmailMetric('email_sent', 1, 'count', { deliveryTime });
      await this.trackEmailMetric('email_delivery_time_avg', deliveryTime, 'ms');
      
      return response;
    } catch (error) {
      this.logger.error(
        'Error sending email (non-blocking):',
        error?.response?.body || error?.message || error,
      );
      
      // Track failed email delivery
      await this.trackEmailMetric('email_failed', 1, 'count', { 
        error: error?.response?.body || error?.message || 'unknown' 
      });
      
      return null;
    }
  }

  private async trackEmailMetric(metricName: string, value: number, unit: string, metadata?: Record<string, any>) {
    try {
      const metric = this.operationalMetricRepository.create({
        metricName,
        value,
        unit,
        timestamp: new Date(),
        metadata,
      });
      await this.operationalMetricRepository.save(metric);
    } catch (error) {
      this.logger.error('Failed to track email metric:', error);
    }
  }
}
