import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class EnvVarItem {
  @IsString()
  key: string;

  @IsString()
  value: string;

  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;
}

export class SetEnvDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EnvVarItem)
  vars: EnvVarItem[];
}

export class SetDomainDto {
  @IsString()
  host: string;

  @IsOptional()
  @IsBoolean()
  https?: boolean;
}
