import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_f2_history_snapshots_gc.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001
    }
  }
  