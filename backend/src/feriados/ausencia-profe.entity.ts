import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { TipoAusencia } from './/ausencia-profe.types';

@Entity('ausencias_profe')
export class AusenciaProfe {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'date' })
  fecha!: string; // YYYY-MM-DD

  @Column({ type: 'varchar', length: 20 })
  tipo!: TipoAusencia;

  @Column({ type: 'time', nullable: true })
  hora?: string; // solo si tipo = 'horario'

  @Column({ type: 'text', nullable: true })
  motivo?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
