import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-politica-de-cookies',
  standalone: true,
  imports: [],
  templateUrl: './politica-de-cookies.component.html',
  styleUrl: './politica-de-cookies.component.css'
})
export class PoliticaDeCookiesComponent {
  constructor(private router: Router) {}

  volverAlInicio() {
    this.router.navigate(['/']);
  }
}
