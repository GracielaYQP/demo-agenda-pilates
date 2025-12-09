import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-terminos-y-condiciones',
  standalone: true,
  imports: [],
  templateUrl: './terminos-y-condiciones.component.html',
  styleUrl: './terminos-y-condiciones.component.css'
})
export class TerminosYCondicionesComponent {
  constructor(private router: Router) {}

  volverAlInicio() {
    this.router.navigate(['/']);
  }
}
