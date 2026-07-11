import { IsString, MinLength } from 'class-validator';

export class Disable2faDto {
  /** Current password, required to turn 2FA off. */
  @IsString()
  @MinLength(1)
  password: string;
}
