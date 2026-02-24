import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class UpsertPagoCicloDto {
  @IsInt()
  userId!: number;

  @IsIn(['suelta','4','8','12'])
  planTipo!: 'suelta'|'4'|'8'|'12';

  @IsInt()
  @IsPositive()
  montoARS!: number;

  @IsOptional()
  @IsIn(['efectivo','transferencia','mercado_pago','otro'])
  metodo?: 'efectivo'|'transferencia'|'mercado_pago'|'otro';

  @IsOptional()
  @IsString()
  notas?: string;
}
