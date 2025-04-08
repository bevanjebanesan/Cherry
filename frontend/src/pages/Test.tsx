import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Box,
  Button,
  Container,
  Typography,
  Paper,
  CircularProgress,
  Alert,
} from '@mui/material';

const Test: React.FC = () => {
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [backendUrl, setBackendUrl] = useState<string>('');

  useEffect(() => {
    // Get the backend URL from environment variables
    const url = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
    setBackendUrl(url);
  }, []);

  const testBackendConnection = async () => {
    setLoading(true);
    setError(null);
    setTestResult(null);
    
    try {
      console.log('Testing connection to:', backendUrl);
      const response = await axios.get(`${backendUrl}/api/test`);
      console.log('Test response:', response.data);
      setTestResult(JSON.stringify(response.data, null, 2));
    } catch (error: any) {
      console.error('Error testing backend:', error);
      if (error.response) {
        setError(`Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        setError('No response received from server. The backend might be down or unreachable.');
      } else {
        setError(`Error: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const testMeetingCreation = async () => {
    setLoading(true);
    setError(null);
    setTestResult(null);
    
    try {
      console.log('Testing meeting creation at:', backendUrl);
      const response = await axios.post(`${backendUrl}/api/meetings/create`);
      console.log('Meeting creation response:', response.data);
      setTestResult(JSON.stringify(response.data, null, 2));
    } catch (error: any) {
      console.error('Error creating meeting:', error);
      if (error.response) {
        setError(`Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        setError('No response received from server. The backend might be down or unreachable.');
      } else {
        setError(`Error: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ my: 8 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Backend Connection Test
        </Typography>
        
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="body1" gutterBottom>
            Current backend URL: <code>{backendUrl}</code>
          </Typography>
          
          <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
            <Button 
              variant="contained" 
              onClick={testBackendConnection}
              disabled={loading}
            >
              Test API Connection
            </Button>
            
            <Button 
              variant="contained" 
              color="secondary"
              onClick={testMeetingCreation}
              disabled={loading}
            >
              Test Meeting Creation
            </Button>
          </Box>
        </Paper>
        
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 4 }}>
            <CircularProgress />
          </Box>
        )}
        
        {error && (
          <Alert severity="error" sx={{ my: 2 }}>
            {error}
          </Alert>
        )}
        
        {testResult && (
          <Paper sx={{ p: 3, mt: 3 }}>
            <Typography variant="h6" gutterBottom>
              Test Result:
            </Typography>
            <Box 
              component="pre" 
              sx={{ 
                p: 2, 
                backgroundColor: 'rgba(0,0,0,0.05)', 
                borderRadius: 1,
                overflow: 'auto'
              }}
            >
              {testResult}
            </Box>
          </Paper>
        )}
      </Box>
    </Container>
  );
};

export default Test;
