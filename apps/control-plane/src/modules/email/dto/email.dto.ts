import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SetEmailConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  // true = implicit TLS (usually :465); false = STARTTLS (usually :587).
  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  // Omit to keep the stored password; send a value to rotate it.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromEmail?: string;
}

export class SendTestDto {
  // Where to send the test; defaults to the configured sender address.
  @IsOptional()
  @IsEmail()
  to?: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  body!: string;

  // 'all' broadcasts to every registered user; 'custom' uses `recipients`.
  @IsIn(['all', 'custom'])
  recipientKind!: 'all' | 'custom';

  // Comma / whitespace / newline separated address list (only for 'custom').
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  recipients?: string;
}
