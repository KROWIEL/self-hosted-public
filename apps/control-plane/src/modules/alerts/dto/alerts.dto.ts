import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ALERT_EVENTS } from '../alerts.constants';
import { ALERT_CHANNEL_TYPES } from '../alerts.delivery';

export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsIn([...ALERT_CHANNEL_TYPES])
  type?: (typeof ALERT_CHANNEL_TYPES)[number];

  // webhook / discord / slack — https incoming webhook URL.
  // require_tld:false keeps self-hosted n8n / Mattermost on LAN hostnames viable
  // for the generic `webhook` type (SSRF checks run at send time for SaaS types).
  @ValidateIf((o: CreateChannelDto) => (o.type ?? 'webhook') !== 'telegram')
  @IsString()
  @IsUrl({ require_tld: false, protocols: ['https'], require_protocol: true })
  url?: string;

  @ValidateIf((o: CreateChannelDto) => o.type === 'telegram')
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  botToken?: string;

  @ValidateIf((o: CreateChannelDto) => o.type === 'telegram')
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  chatId?: string;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, protocols: ['https'], require_protocol: true })
  url?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  botToken?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  chatId?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsIn(ALERT_EVENTS as unknown as string[])
  event!: string;

  @IsString()
  channelId!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
