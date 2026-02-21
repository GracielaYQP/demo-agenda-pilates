export type TipoAusencia = 'dia' | 'manana' | 'tarde' | 'horario';

export type CierreTipo = TipoAusencia | null;

export interface ListResponse<T> {
  count: number;
  list: T[];
}
