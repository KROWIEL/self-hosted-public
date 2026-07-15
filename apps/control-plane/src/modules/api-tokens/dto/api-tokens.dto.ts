import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';

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
}
