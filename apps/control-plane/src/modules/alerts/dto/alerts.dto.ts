import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ALERT_EVENTS } from '../alerts.constants';

export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsIn(['webhook'])
  type?: 'webhook';

  // Allow internal hosts (self-hosted webhooks, n8n, etc.).
  @IsString()
  @IsUrl({ require_tld: false })
  url!: string;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  url?: string;

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
