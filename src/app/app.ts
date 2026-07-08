import { Component } from '@angular/core';
import { Dashboard } from './components/dashboard/dashboard';

@Component({
  selector: 'app-root',
  imports: [Dashboard],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
