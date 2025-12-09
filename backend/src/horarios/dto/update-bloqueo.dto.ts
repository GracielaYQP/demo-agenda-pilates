import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class UpdateBloqueoDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  blockedReformers!: number;
}