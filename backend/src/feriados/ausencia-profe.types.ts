export type TipoAusencia = 'dia' | 'manana' | 'tarde' | 'horario';
export interface ListResponse<T> {
  count: number;
  list: T[];
}