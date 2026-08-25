// types/8x8.types.ts
export interface EightEightUser {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  moderator?: boolean;
  roles?: string[];
}

export interface EightEightContext {
  user: EightEightUser;
  group?: string;
  features?: Record<string, boolean>;
  app?: {
    name: string;
    url?: string;
    version?: string;
  };
}

export interface EightEightTokenPayload {
  aud: 'jitsi';
  iss: string;  // API Key
  sub: string;  // Usually "*" or user ID
  room: string;
  exp: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  context: EightEightContext;
  moderator?: boolean;
  livestreaming?: boolean;
  recording?: boolean;
  screen_sharing?: boolean;
}

export interface GenerateTokenOptions {
  roomName: string;
  user: EightEightUser;
  isModerator?: boolean;
  allowRecording?: boolean;
  allowLiveStreaming?: boolean;
  allowScreenSharing?: boolean;
  expiresIn?: number; // seconds
  groupId?: string;
  features?: Record<string, boolean>;
}