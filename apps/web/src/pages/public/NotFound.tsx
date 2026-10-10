import { Button, Container, Stack, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <Container maxWidth="sm" sx={{ py: 10 }}>
      <Stack spacing={2} alignItems="flex-start">
        <Typography variant="h1">Page not found</Typography>
        <Typography color="text.secondary">The page you were looking for does not exist or you do not have access to it.</Typography>
        <Button component={Link} to="/" variant="contained">
          Go home
        </Button>
      </Stack>
    </Container>
  );
}
