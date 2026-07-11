import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TemplateVariableDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(100)
  envVariable: string;

  @IsString()
  @MaxLength(500)
  defaultValue: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  rules?: string;
}
