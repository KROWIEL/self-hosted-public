import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
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
  // Strict FQDN only. This blocks backticks/parens/pipes and other characters
  // that would let a crafted "host" break out of the Traefik Host() rule
  // and hijack routing for other services.
  @IsString()
  @Matches(/^(?!-)[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/, {
    message: 'host must be a valid fully-qualified domain name',
  })
  host: string;

  @IsOptional()
  @IsBoolean()
  https?: boolean;
}
