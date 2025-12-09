// reserva.entity.ts
import { Entity, PrimaryGeneratedColumn, ManyToOne, Column, JoinColumn } from 'typeorm';
import { Horario } from '../horarios/horarios.entity';
import { User } from '../users/user.entity'; // si ya tenés un modelo de usuario
export type TipoReserva = 'automatica' | 'recuperacion' | 'suelta';
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
  estado!: 'reservado' | 'cancelado' |'recuperada';

  @Column({ default: true })
  automatica!: boolean;

  @Column({ type: 'varchar', length: 20, default: 'automatica' })
  tipo!: TipoReserva;

  @Column({ default: false })
  cancelacionMomentanea!: boolean;

  @Column({ default: false })
  cancelacionPermanente!: boolean;

  @Column({ type: 'date', nullable: true })
  fechaCancelacion?: Date;


  @ManyToOne(() => Horario, horario => horario.reservas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'horarioId' }) // 👈 asegurate de tener esto
  horario!: Horario;

  @ManyToOne(() => User, user => user.reservas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuarioId' }) // 👈 esto también
  usuario!: User;

}
