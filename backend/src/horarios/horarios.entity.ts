import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { Reserva } from '../reserva/reserva.entity';

@Entity('horarios')
export class Horario {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  dia!: string;

  @Column()
  hora!: string;

  @Column()
  nivel!: string;

  @Column({ default: 5 })
  totalReformers!: number;

  @Column({ default: 0 })
  reformersReservados!: number;

  @Column({ name: 'blocked_reformers', type: 'int', default: 0 })
  blockedReformers!: number;


  @OneToMany(() => Reserva, reserva => reserva.horario, { cascade: true })
  reservas!: Reserva[];

}
