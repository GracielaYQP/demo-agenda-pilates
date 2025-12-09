import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-politica-de-privacidad',
  standalone: true,
  imports: [],
  templateUrl: './politica-de-privacidad.component.html',
  styleUrl: './politica-de-privacidad.component.css'
})
export class PoliticaDePrivacidadComponent {
  constructor(private router: Router) {}

  volverAlInicio() {
    this.router.navigate(['/']);
  }
}
