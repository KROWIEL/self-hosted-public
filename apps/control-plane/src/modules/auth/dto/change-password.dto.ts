import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword: string;

  // Strength enforced in AuthService (shared password policy → coded error).
  @IsString()
  @MinLength(1)
  newPassword: string;
}
