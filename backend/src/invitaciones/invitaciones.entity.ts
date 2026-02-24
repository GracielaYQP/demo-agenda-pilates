import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

// ⬇️ Tipo para el estado de la invitación
export type EstadoInvitacion = 'pendiente' | 'usado' | 'anulado';
export type RolInvitacion = 'admin' | 'alumno';

@Entity('invitaciones')
@Unique('u_token', ['token'])         
@Index('i_estado', ['estado'])       
export class Invitacion {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 30 })
  telefono!: string;

  @Column({ unique: true, length: 200 })
  token!: string;

  @Column({ type: 'varchar', length: 10, default: 'alumno' })
  rol!: RolInvitacion;

  @Column({ type: 'varchar', length: 20, nullable: true })
  nivel_asignado?: string | null;

  @Column({ type: 'varchar', length: 12, default: 'pendiente' })
  estado!: EstadoInvitacion;

  @Column({ type: 'timestamptz', nullable: true })
  expiraEn?: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
