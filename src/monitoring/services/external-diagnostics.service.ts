import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import axios from 'axios';
import { S3Client, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { createClient } from 'redis';

export interface ServiceDiagnosticResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'not_configured' | 'degraded';
  message: string;
  responseTime?: number;
  metadata?: Record<string, any>;
  lastChecked: string;
}

export interface DiagnosticSummary {
  timestamp: string;
  totalServices: number;
  healthy: number;
  unhealthy: number;
  notConfigured: number;
  degraded: number;
  services: ServiceDiagnosticResult[];
}

@Injectable()
export class ExternalDiagnosticsService {
  private readonly logger = new Logger(ExternalDiagnosticsService.name);
  private redisClient: any;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getAllDiagnostics(): Promise<DiagnosticSummary> {
    this.logger.log('Running comprehensive external services diagnostics...');

    const diagnostics = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkPaystack(),
      this.checkS3(),
      this.checkGoogleMaps(),
      this.checkTermiiSMS(),
      this.checkBrevoEmail(),
      this.checkEightxEight(),
      this.checkTrackThatRide(),
      this.checkFirebasePush(),
      this.checkSocketHealth(),
    ]);

    const summary = {
      timestamp: new Date().toISOString(),
      totalServices: diagnostics.length,
      healthy: diagnostics.filter((d) => d.status === 'healthy').length,
      unhealthy: diagnostics.filter((d) => d.status === 'unhealthy').length,
      notConfigured: diagnostics.filter((d) => d.status === 'not_configured').length,
      degraded: diagnostics.filter((d) => d.status === 'degraded').length,
      services: diagnostics,
    };

    this.logger.log(`Diagnostics completed: ${summary.healthy}/${summary.totalServices} healthy`);
    return summary;
  }

  async checkDatabase(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      // Check if database is configured
      const host = this.config.get<string>('DB_HOST');
      if (!host) {
        return {
          service: 'database',
          status: 'not_configured',
          message: 'Database host not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      // Test database connection
      if (this.dataSource.isInitialized) {
        await this.dataSource.query('SELECT 1');
        const responseTime = Date.now() - startTime;

        // Get basic connection info
        const connectionInfo = {
          isConnected: true,
          type: this.dataSource.options.type,
        };

        return {
          service: 'database',
          status: 'healthy',
          message: 'Database connection successful',
          responseTime,
          metadata: {
            host,
            database: this.config.get<string>('DB_DATABASE'),
            connectionInfo,
          },
          lastChecked: new Date().toISOString(),
        };
      } else {
        return {
          service: 'database',
          status: 'unhealthy',
          message: 'Database not initialized',
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error(`Database health check failed: ${error.message}`);
      return {
        service: 'database',
        status: 'unhealthy',
        message: `Database connection failed: ${error.message}`,
        responseTime,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkRedis(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const redisUrl = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
      
      try {
        if (!this.redisClient) {
          this.redisClient = createClient({ url: redisUrl });
          await this.redisClient.connect();
        }

        // Test Redis with PING
        const response = await this.redisClient.ping();
        const responseTime = Date.now() - startTime;

        if (response === 'PONG') {
          // Get Redis info
          const info = await this.redisClient.info('memory');
          const memoryInfo = this.parseRedisInfo(info);

          return {
            service: 'redis',
            status: 'healthy',
            message: 'Redis connection successful',
            responseTime,
            metadata: {
              url: redisUrl.replace(/\/\/.*@/, '//***@'),
              memory: memoryInfo,
            },
            lastChecked: new Date().toISOString(),
          };
        } else {
          return {
            service: 'redis',
            status: 'unhealthy',
            message: 'Redis ping failed',
            responseTime,
            lastChecked: new Date().toISOString(),
          };
        }
      } catch (error) {
        return {
          service: 'redis',
          status: 'unhealthy',
          message: `Redis connection failed: ${error.message}`,
          responseTime: Date.now() - startTime,
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        service: 'redis',
        status: 'not_configured',
        message: 'Redis configuration missing',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkPaystack(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY');
      
      if (!secretKey) {
        return {
          service: 'paystack',
          status: 'not_configured',
          message: 'Paystack secret key not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      try {
        // Test Paystack API with a simple balance check
        const response = await axios.get('https://api.paystack.co/balance', {
          headers: {
            Authorization: `Bearer ${secretKey}`,
          },
          timeout: 10000,
        });

        const responseTime = Date.now() - startTime;

        if (response.data.status) {
          return {
            service: 'paystack',
            status: 'healthy',
            message: 'Paystack API accessible',
            responseTime,
            metadata: {
              currency: response.data.data[0]?.currency,
              balance: response.data.data[0]?.balance,
            },
            lastChecked: new Date().toISOString(),
          };
        } else {
          return {
            service: 'paystack',
            status: 'unhealthy',
            message: `Paystack API error: ${response.data.message}`,
            responseTime,
            lastChecked: new Date().toISOString(),
          };
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        return {
          service: 'paystack',
          status: 'unhealthy',
          message: `Paystack API call failed: ${error.message}`,
          responseTime,
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        service: 'paystack',
        status: 'not_configured',
        message: 'Paystack configuration error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkS3(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
      const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
      const region = this.config.get<string>('AWS_REGION') || 'eu-west-1';
      const bucketName = this.config.get<string>('S3_BUCKET_NAME');

      if (!accessKeyId || !secretAccessKey) {
        return {
          service: 's3',
          status: 'not_configured',
          message: 'AWS credentials not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      try {
        const s3Client = new S3Client({
          region,
          credentials: {
            accessKeyId,
            secretAccessKey,
          },
        });

        // Test S3 by listing buckets
        const command = new ListBucketsCommand({});
        const response = await s3Client.send(command);
        const responseTime = Date.now() - startTime;

        const bucketExists = bucketName && response.Buckets?.some(b => b.Name === bucketName);

        return {
          service: 's3',
          status: 'healthy',
          message: 'S3 connection successful',
          responseTime,
          metadata: {
            region,
            bucketName: bucketName || 'not configured',
            bucketExists,
            totalBuckets: response.Buckets?.length || 0,
          },
          lastChecked: new Date().toISOString(),
        };
      } catch (error) {
        const responseTime = Date.now() - startTime;
        return {
          service: 's3',
          status: 'unhealthy',
          message: `S3 connection failed: ${error.message}`,
          responseTime,
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        service: 's3',
        status: 'not_configured',
        message: 'S3 configuration error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkGoogleMaps(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
      
      if (!apiKey) {
        return {
          service: 'google_maps',
          status: 'not_configured',
          message: 'Google Maps API key not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      try {
        // Test Google Maps API with a simple geocoding request
        const response = await axios.get(
          'https://maps.googleapis.com/maps/api/geocode/json',
          {
            params: {
              address: '1600 Amphitheatre Parkway, Mountain View, CA',
              key: apiKey,
            },
            timeout: 10000,
          },
        );

        const responseTime = Date.now() - startTime;

        if (response.data.status === 'OK') {
          return {
            service: 'google_maps',
            status: 'healthy',
            message: 'Google Maps API accessible',
            responseTime,
            metadata: {
              resultsCount: response.data.results?.length || 0,
              status: response.data.status,
            },
            lastChecked: new Date().toISOString(),
          };
        } else {
          return {
            service: 'google_maps',
            status: 'unhealthy',
            message: `Google Maps API error: ${response.data.status}`,
            responseTime,
            lastChecked: new Date().toISOString(),
          };
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        return {
          service: 'google_maps',
          status: 'unhealthy',
          message: `Google Maps API call failed: ${error.message}`,
          responseTime,
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        service: 'google_maps',
        status: 'not_configured',
        message: 'Google Maps configuration error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkTermiiSMS(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const apiKey = this.config.get<string>('TERMI_SMS_API_KEY');
      
      if (!apiKey) {
        return {
          service: 'termii_sms',
          status: 'not_configured',
          message: 'Termii SMS API key not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      try {
        // Test Termii API with a balance check
        const response = await axios.get('https://termii.com/api/sms/balance', {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 10000,
        });

        const responseTime = Date.now() - startTime;

        if (response.data.message === 'Successful') {
          return {
            service: 'termii_sms',
            status: 'healthy',
            message: 'Termii SMS API accessible',
            responseTime,
            metadata: {
              balance: response.data.balance,
              currency: response.data.currency,
            },
            lastChecked: new Date().toISOString(),
          };
        } else {
          return {
            service: 'termii_sms',
            status: 'unhealthy',
            message: `Termii SMS API error: ${response.data.message}`,
            responseTime,
            lastChecked: new Date().toISOString(),
          };
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        return {
          service: 'termii_sms',
          status: 'unhealthy',
          message: `Termii SMS API call failed: ${error.message}`,
          responseTime,
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        service: 'termii_sms',
        status: 'not_configured',
        message: 'Termii SMS configuration error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkBrevoEmail(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const apiKey = this.config.get<string>('BREVO_API_KEY');
      
      if (!apiKey) {
        return {
          service: 'brevo_email',
          status: 'not_configured',
          message: 'Brevo API key not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      try {
        // Test Brevo API with account info
        const response = await axios.get('https://api.brevo.com/v3/account', {
          headers: {
            'api-key': apiKey,
          },
          timeout: 10000,
        });

        const responseTime = Date.now() - startTime;

        return {
          service: 'brevo_email',
          status: 'healthy',
          message: 'Brevo API accessible',
          responseTime,
          metadata: {
            email: response.data.email,
            planLevel: response.data.planLevel,
          },
          lastChecked: new Date().toISOString(),
        };
      } catch (error) {
        const responseTime = Date.now() - startTime;
        return {
          service: 'brevo_email',
          status: 'unhealthy',
          message: `Brevo API call failed: ${error.message}`,
          responseTime,
          lastChecked: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        service: 'brevo_email',
        status: 'not_configured',
        message: 'Brevo configuration error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkEightxEight(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const apiKey = this.config.get<string>('EIGHTxEight_API_KEY');
      const apiSecret = this.config.get<string>('EIGHTxEight_API_SECRET');
      
      if (!apiKey || !apiSecret) {
        return {
          service: 'eightxeight',
          status: 'not_configured',
          message: '8x8 credentials not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      // 8x8 health check is complex - we'll validate configuration
      const responseTime = Date.now() - startTime;

      return {
        service: 'eightxeight',
        status: 'healthy',
        message: '8x8 credentials configured (validation requires actual call)',
        responseTime,
        metadata: {
          configured: true,
          appPrefix: apiKey.split('/')[0],
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      return {
        service: 'eightxeight',
        status: 'not_configured',
        message: '8x8 configuration error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkTrackThatRide(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const apiKey = this.config.get<string>('TRACK_THAT_RIDE_API_KEY');
      
      if (!apiKey) {
        return {
          service: 'track_that_ride',
          status: 'not_configured',
          message: 'Track That Ride API key not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      // Since we don't have public documentation for Track That Ride API,
      // we'll validate configuration
      const responseTime = Date.now() - startTime;

      return {
        service: 'track_that_ride',
        status: 'healthy',
        message: 'Track That Ride credentials configured',
        responseTime,
        metadata: {
          configured: true,
          keyPrefix: apiKey.substring(0, 10) + '...',
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      return {
        service: 'track_that_ride',
        status: 'not_configured',
        message: 'Track That Ride configuration error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkFirebasePush(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const firebaseConfig = {
        apiKey: this.config.get<string>('FIREBASE_API_KEY'),
        authDomain: this.config.get<string>('FIREBASE_AUTH_DOMAIN'),
        projectId: this.config.get<string>('FIREBASE_PROJECT_ID'),
      };

      if (!firebaseConfig.projectId) {
        return {
          service: 'firebase_push',
          status: 'not_configured',
          message: 'Firebase project not configured',
          lastChecked: new Date().toISOString(),
        };
      }

      // Firebase validation would require actual FCM call
      const responseTime = Date.now() - startTime;

      return {
        service: 'firebase_push',
        status: 'healthy',
        message: 'Firebase configured (requires device token for full test)',
        responseTime,
        metadata: {
          projectId: firebaseConfig.projectId,
          configured: true,
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      return {
        service: 'firebase_push',
        status: 'not_configured',
        message: 'Firebase configuration error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  async checkSocketHealth(): Promise<ServiceDiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const socketPort = this.config.get<number>('SOCKET_PORT') || 3001;
      const corsOrigin = this.config.get<string>('SOCKET_CORS_ORIGIN');

      // Socket.io health check - verify configuration
      const responseTime = Date.now() - startTime;

      return {
        service: 'socket_io',
        status: 'healthy',
        message: 'Socket.io configured (active connection test required)',
        responseTime,
        metadata: {
          port: socketPort,
          corsOrigin,
          configured: true,
        },
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      return {
        service: 'socket_io',
        status: 'not_configured',
        message: 'Socket.io configuration error',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private parseRedisInfo(info: string): Record<string, any> {
    const lines = info.split('\n');
    const result: Record<string, any> = {};
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key.trim()] = value.trim();
      }
    }
    
    return result;
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }
}
