import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  // Strength is enforced in AuthService via the shared password policy so the
  // client receives a single coded 'auth.weakPassword' error to localize.
  @IsString()
  @MinLength(1)
  password: string;
}
