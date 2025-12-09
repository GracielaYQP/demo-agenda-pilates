import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ValorPlan } from './valor-planes.entity';
import { UpsertValorPlanDto } from './dto/upsert-valor-plan.dto';

@Injectable()
export class ValorPlanesService {
  constructor(
    @InjectRepository(ValorPlan) private repo: Repository<ValorPlan>,
  ) {}

  private order(tipo: ValorPlan['tipo']) {
    const orden = { suelta: 0, '4': 1, '8': 2, '12': 3 } as const;
    return orden[tipo];
  }

  async upsert(dto: UpsertValorPlanDto) {
    const existing = await this.repo.findOne({ where: { tipo: dto.tipo } });
    const toSave = existing ? { ...existing, ...dto } : this.repo.create(dto);
    return this.repo.save(toSave);
  }

  async getPublic() {
    const rows = await this.repo.find({ where: { visible: true } });
    return rows.sort((a,b) => this.order(a.tipo) - this.order(b.tipo));
  }

  async getAll() {
    const rows = await this.repo.find();
    return rows.sort((a,b) => this.order(a.tipo) - this.order(b.tipo));
  }

  async getByTipo(tipo: ValorPlan['tipo']) {
    return this.repo.findOne({ where: { tipo } });
  }
}

