// src/jitsi/services/eight-eight-token.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';

export interface MeetingUser {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  moderator?: boolean;
}

export interface GenerateTokenOptions {
  roomName: string;
  user: MeetingUser;
  isModerator?: boolean;
  allowRecording?: boolean;
  allowLiveStreaming?: boolean;
  allowScreenSharing?: boolean;
  expiresIn?: number;
  features?: Record<string, boolean>;
}

@Injectable()
export class EightEightTokenService {
  private readonly logger = new Logger(EightEightTokenService.name);
  
  constructor(private configService: ConfigService) {}
  
  private readonly API_KEY = this.configService.get('EIGHTxEIGHT_API_KEY');
  private readonly API_SECRET = this.configService.get('EIGHTxEIGHT_API_SECRET');
  private readonly DOMAIN = this.configService.get('EIGHTxEIGHT_DOMAIN', '8x8.vc');
  
  /**
   * Generate JWT token for 8x8 Jitsi meeting
   */
  async generateMeetingToken(options: GenerateTokenOptions): Promise<{
    token: string;
    roomUrl: string;
    roomName: string;
  }> {
    try {
      const {
        roomName,
        user,
        isModerator = false,
        allowRecording = false,
        allowLiveStreaming = false,
        allowScreenSharing = true,
        expiresIn = parseInt(this.configService.get('JWT_EXPIRY', '7200')),
        features = {},
      } = options;
      
      // Create context object
      const context = {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          moderator: isModerator,
          roles: isModerator ? ['moderator'] : ['guest'],
        },
        features: {
          'recording': allowRecording,
          'livestreaming': allowLiveStreaming,
          'screen-sharing': allowScreenSharing,
          ...features,
        },
      };
      
      // Create the JWT payload
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        aud: 'jitsi',
        iss: this.API_KEY,
        sub: user.id || '*',
        room: roomName,
        exp: now + expiresIn,
        nbf: now - 60,
        iat: now,
        jti: uuidv4(),
        context: context,
        moderator: isModerator,
        livestreaming: allowLiveStreaming,
        recording: allowRecording,
        screen_sharing: allowScreenSharing,
      };
      
      // Generate the token
      const token = jwt.sign(payload, this.API_SECRET, {
        algorithm: 'HS256',
      });
      
      // Generate room URL
      const roomUrl = `https://${this.DOMAIN}/${roomName}?jwt=${token}`;
      
      this.logger.log(`Token generated for room: ${roomName}, user: ${user.name}`);
      
      return {
        token,
        roomUrl,
        roomName,
      };
      
    } catch (error) {
      this.logger.error('Failed to generate 8x8 token:', error);
      throw new Error(`Token generation failed: ${error.message}`);
    }
  }
  
  /**
   * Generate telemedicine consultation link with instant join
   */
  async generateTelemedicineLink(
    roomName: string,
    doctor: { id: string; name: string; email?: string },
    patient: { id: string; name: string; email?: string }
  ): Promise<{
    doctorLink: string;
    patientLink: string;
    roomName: string;
    meetingUrl: string;
  }> {
    try {
      // Generate doctor token (moderator)
      const doctorToken = await this.generateMeetingToken({
        roomName,
        user: {
          id: doctor.id,
          name: `👨‍⚕️ ${doctor.name}`,
          email: doctor.email,
          avatar: 'https://cdn-icons-png.flaticon.com/512/3067/3067256.png',
          moderator: true,
        },
        isModerator: true,
        allowRecording: false, // Disable recording for privacy
        allowLiveStreaming: false,
        allowScreenSharing: true, // Doctors may need to share screen
      });
      
      // Generate patient token (non-moderator)
      const patientToken = await this.generateMeetingToken({
        roomName,
        user: {
          id: patient.id,
          name: `👤 ${patient.name}`,
          email: patient.email,
          avatar: 'https://cdn-icons-png.flaticon.com/512/847/847969.png',
          moderator: false,
        },
        isModerator: false,
        allowRecording: false,
        allowLiveStreaming: false,
        allowScreenSharing: false, // Patients usually don't need screen sharing
      });
      
      // Generate instant join configuration
      const instantJoinConfig = {
        configOverwrite: {
          prejoinPageEnabled: false,
          enableLobby: false,
          requireDisplayName: false,
          startWithAudioMuted: true, // Patients join muted
          startWithVideoMuted: false,
          disableModeratorIndicator: true,
        },
      };
      
      const encodedConfig = encodeURIComponent(JSON.stringify(instantJoinConfig));
      
      return {
        doctorLink: `${doctorToken.roomUrl}#config=${encodedConfig}`,
        patientLink: `${patientToken.roomUrl}#config=${encodedConfig}`,
        roomName,
        meetingUrl: `https://${this.DOMAIN}/${roomName}`,
      };
    } catch (error) {
      this.logger.error('Failed to generate telemedicine links:', error);
      throw error;
    }
  }
}