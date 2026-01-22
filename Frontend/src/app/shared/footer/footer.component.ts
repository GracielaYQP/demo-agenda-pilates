import { Component } from '@angular/core';
import { BRAND } from 'src/app/core/config/brand';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.css'
})
export class FooterComponent {
  brand = BRAND;
}


