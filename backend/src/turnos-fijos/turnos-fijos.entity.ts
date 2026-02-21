import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Horario } from '../horarios/horarios.entity';

@Entity('turnos_fijos')

// ✅ recomendación: este índice NO hace falta si ya tenés el UNIQUE (usuarioId, horarioId)
// pero si lo querés mantener, no rompe.
@Index('ix_turnos_fijos_horario_activo', ['horarioId', 'activo'])
@Index('ix_turnos_fijos_usuario_activo', ['usuarioId', 'activo'])

// ✅ IMPORTANTE: si en DB tenés UNIQUE (usuarioId, horarioId) mantenelo también acá
@Index('ux_turno_fijo_usuario_horario', ['usuarioId', 'horarioId'], { unique: true })
export class TurnoFijo {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  usuarioId!: number;

  @Column()
  horarioId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuarioId' })
  usuario!: User;

  @ManyToOne(() => Horario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'horarioId' })
  horario!: Horario;

  @Column({ default: true })
  activo!: boolean;

  // ✅ BAJA
  @Column({ type: 'date', nullable: true })
  fechaBaja?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  motivoBaja?: string | null;

  // ✅ ALTA / REACTIVACIÓN (lo que agregaste en DB)
  @Column({ type: 'date', nullable: true })
  fechaAlta?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  motivoAlta?: string | null;

  @Column({ type: 'int', default: 0 })
  reactivadoCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}