import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTunnelDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  serverHost!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  controlPort?: number;

  @IsOptional()
  @IsString()
  relayPorts?: string;

  @IsOptional()
  @IsString()
  targetHost?: string;

  @IsOptional()
  @IsBoolean()
  proxyProtocol?: boolean;

  @IsOptional()
  @IsString()
  fingerprint?: string;
}

export class UpdateTunnelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  serverHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  controlPort?: number;

  @IsOptional()
  @IsString()
  relayPorts?: string;

  @IsOptional()
  @IsString()
  targetHost?: string;

  @IsOptional()
  @IsBoolean()
  proxyProtocol?: boolean;

  @IsOptional()
  @IsString()
  fingerprint?: string;
}
