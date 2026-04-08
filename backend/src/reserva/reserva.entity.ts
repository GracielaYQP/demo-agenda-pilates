import { Entity, PrimaryGeneratedColumn, ManyToOne, Column, JoinColumn } from 'typeorm';
import { Horario } from '../horarios/horarios.entity';
import { User } from '../users/user.entity'; // si ya tenés un modelo de usuario
export type TipoReserva = 'automatica' | 'recuperacion' | 'suelta'| 'cerrado';
@Entity('reservas')
export class Reserva {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  nombre!: string;

  @Column()
  apellido!: string;

  @Column({ type: 'date' }) 
  fechaTurno!: string;

  @Column({ type: 'date' }) 
  fechaReserva!: string;

  @Column({ default: 'reservado' })
  estado!: 'reservado' | 'cancelado' |'recuperada'| 'cerrado';

  @Column({ default: true })
  automatica!: boolean;

  @Column({ type: 'varchar', length: 20, default: 'automatica' })
  tipo!: TipoReserva;

  @Column({ default: false })
  cancelacionMomentanea!: boolean;

  @Column({ default: false })
  cancelacionPermanente!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  fechaCancelacion?: Date;

  @Column({ type: 'boolean', default: false })
  cierreEstudio!: boolean;

  @ManyToOne(() => Horario, horario => horario.reservas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'horarioId' })
  horario!: Horario;

  @ManyToOne(() => User, user => user.reservas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuarioId' }) 
  usuario!: User;

}
