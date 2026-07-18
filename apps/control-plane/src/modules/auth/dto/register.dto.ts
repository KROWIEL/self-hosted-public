import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  // Strength is enforced in AuthService via the shared password policy so the
  // client receives a single coded 'auth.weakPassword' error to localize.
  @IsString()
  @MinLength(1)
  password: string;

  /** Required when ALLOW_OPEN_REGISTRATION is off (admin-issued invite). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  inviteToken?: string;
}
