import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Home from './pages/Home';
import Meeting from './pages/Meeting';
import './App.css';

// Create a custom theme with pink color scheme
const theme = createTheme({
  palette: {
    primary: {
      main: '#e91e63', // Pink color
      light: '#f48fb1',
      dark: '#c2185b',
    },
    secondary: {
      main: '#9c27b0', // Purple as secondary
      light: '#ce93d8',
      dark: '#7b1fa2',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: `
        body {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          width: 100%;
          overflow-x: hidden;
        }
        #root {
          width: 100%;
          margin: 0;
          padding: 0;
        }
      `,
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/meeting/:meetingId" element={<Meeting />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
