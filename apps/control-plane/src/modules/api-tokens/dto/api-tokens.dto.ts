import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { API_TOKEN_SCOPES } from '../api-tokens.constants';

export class CreateApiTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  // Optional lifetime in days; omit for a non-expiring token.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;

  // Optional authorization scopes (M4). Omit for the default 'full' (read+write,
  // no admin). Include 'admin' to allow platform-admin routes; 'read' for a
  // read-only token.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(API_TOKEN_SCOPES as unknown as string[], { each: true })
  scopes?: string[];
}
