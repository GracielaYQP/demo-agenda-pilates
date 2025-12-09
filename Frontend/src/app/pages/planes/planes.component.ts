import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ValorPlanesService } from 'src/app/services/valor-planes.service';


@Component({
  selector: 'app-planes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './planes.component.html',
  styleUrl: './planes.component.css'
})
export class PlanesComponent implements OnInit {

  precios: Record<string, number> = {};

  constructor(private valorSrv: ValorPlanesService, private router: Router) {}

  ngOnInit(): void {
    this.valorSrv.getPublic().subscribe((rows) => {
      this.precios = rows.reduce((acc, r) => ({ ...acc, [r.tipo]: r.precioARS }), {});
    });
  }

  formato(ars?: number) {
    if (ars == null) return '-';
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(ars);
  } 
    volverAlInicio() {
      this.router.navigate(['/']);
    }
}
