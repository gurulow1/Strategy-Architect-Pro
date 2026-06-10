//+------------------------------------------------------------------+
//| Strategy Architect Pro — History Exporter EA                     |
//|                                                                  |
//| Attach this EA to any chart. It periodically sends your CLOSED   |
//| trade history (read-only) to your Strategy Architect Pro server. |
//| It never places, modifies, or closes any orders.                 |
//|                                                                  |
//| Setup:                                                           |
//|  1. Tools -> Options -> Expert Advisors -> "Allow WebRequest for |
//|     listed URL" and add your server URL.                         |
//|  2. Set ServerURL and SecretToken in the inputs below.           |
//|  3. Drag the EA onto any chart; allow Algo Trading.              |
//+------------------------------------------------------------------+
#property copyright "Strategy Architect Pro"
#property version   "1.0"
#property strict

input string ServerURL   = "https://YOUR-SERVER.railway.app/api/broker/mt/push";
input string SecretToken = "YOUR-MT-PUSH-TOKEN";
input int    IntervalMin = 30;    // How often to send (minutes)
input int    DaysBack    = 90;    // History depth (days)

int timer_ticks = 0;

int OnInit()
{
   EventSetTimer(60);  // tick every minute
   SendHistory();      // send immediately on attach
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   timer_ticks++;
   if(timer_ticks >= IntervalMin)
   {
      timer_ticks = 0;
      SendHistory();
   }
}

//+------------------------------------------------------------------+
//| Build the trades JSON and POST it to the server.                 |
//+------------------------------------------------------------------+
void SendHistory()
{
   datetime from = TimeCurrent() - (datetime)DaysBack * 86400;

   string json = "[";
   bool   first = true;
   int    sent  = 0;

   if(HistorySelect(from, TimeCurrent()))
   {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
      {
         ulong ticket = HistoryDealGetTicket(i);
         if(ticket == 0) continue;

         // Only count position-closing deals (one realized PnL per close).
         if(HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;

         double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT)
                       + HistoryDealGetDouble(ticket, DEAL_SWAP)
                       + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
         if(profit == 0.0) continue;

         string   sym  = HistoryDealGetString(ticket, DEAL_SYMBOL);
         long     type = HistoryDealGetInteger(ticket, DEAL_TYPE);
         // A closing BUY deal closes a SHORT; a closing SELL closes a LONG.
         string   dir  = (type == DEAL_TYPE_BUY) ? "short" : "long";
         datetime t    = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);

         if(!first) json += ",";
         first = false;
         sent++;

         json += StringFormat(
            "{\"date\":\"%s\",\"pnl\":%.2f,\"symbol\":\"%s\",\"direction\":\"%s\"}",
            TimeToString(t, TIME_DATE|TIME_MINUTES), profit, sym, dir);
      }
   }
   json += "]";

   string body = "{\"accountId\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
               + ",\"trades\":" + json + "}";

   string headers = "Content-Type: application/json\r\nX-MT-Token: " + SecretToken + "\r\n";

   char post[], result[];
   string resultHeaders;
   StringToCharArray(body, post, 0, StringLen(body), CP_UTF8);

   ResetLastError();
   int code = WebRequest("POST", ServerURL, headers, 5000, post, result, resultHeaders);
   if(code == 200) Print("SAP: history sent, deals=", sent);
   else            Print("SAP: send failed, http=", code, " err=", GetLastError(),
                         " (enable WebRequest for ", ServerURL, ")");
}
//+------------------------------------------------------------------+
