import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinanzasDashboardComponent } from '../../admin/tabs/finanzas-dashboard/finanzas-dashboard.component';
import { AlumnosAsistenciaComponent } from '../../admin/tabs/alumnos-asistencia/alumnos-asistencia.component';
import { ClasesOperacionComponent } from '../../admin/tabs/clases-operacion/clases-operacion.component';


@Component({
  selector: 'app-dashboard-tabs',
  standalone: true,
  imports: [CommonModule, FinanzasDashboardComponent, AlumnosAsistenciaComponent, ClasesOperacionComponent],
  templateUrl: './dashboard-tabs.component.html',
  styleUrls: ['./dashboard-tabs.component.css'],
})
export class DashboardTabsComponent {
  tab = signal<'finanzas'|'alumnos'|'clases'>('finanzas');
  setTab(t: 'finanzas'|'alumnos'|'clases') { this.tab.set(t); }
}

