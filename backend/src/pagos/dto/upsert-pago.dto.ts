import { IsIn, IsInt, IsOptional, IsPositive, IsString, Max, Min } from "class-validator";

export class UpsertPagoDto {
  @IsInt() userId!: number;
  @IsInt() @Min(1) @Max(12) mes!: number;
  @IsInt() @Min(2000) @Max(2100) anio!: number;

  @IsIn(['suelta','4','8','12'])
  planTipo!: 'suelta'|'4'|'8'|'12';

  @IsInt() @IsPositive()
  montoARS!: number;

  @IsOptional() @IsIn(['efectivo','transferencia','mercado_pago','otro'])
  metodo?: 'efectivo'|'transferencia'|'mercado_pago'|'otro';

  @IsOptional() @IsString()
  notas?: string;
}