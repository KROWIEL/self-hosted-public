import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDatabaseDto {
  @IsString() name!: string;
  @IsIn(['POSTGRES', 'MYSQL']) engine!: 'POSTGRES' | 'MYSQL';
  @IsOptional() @IsString() version?: string;
  @IsUUID() nodeId!: string;
  @IsOptional() @IsString() dbName?: string;
  @IsOptional() @IsString() username?: string;
}
