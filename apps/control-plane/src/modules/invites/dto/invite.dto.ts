import {
  IsEmail,
  IsInt,
  IsIn,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class CreateInviteDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Invite lifetime in days (default 7, max 30). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;

  @IsOptional()
  @IsIn(['USER', 'ADMIN'])
  role?: 'USER' | 'ADMIN';
}
