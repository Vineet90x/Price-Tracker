"""A protected endpoint, so the Angular interceptor has something real to authenticate against.
Holdings are demo data (not stored per user) to keep Phase 1.5 small."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..deps import get_current_user
from ..models import User

router = APIRouter(prefix="/api", tags=["portfolio"])


class Holding(BaseModel):
    symbol: str
    quantity: float
    avg_price: float


class PortfolioOut(BaseModel):
    email: str
    holdings: list[Holding]


DEMO_HOLDINGS = [
    Holding(symbol="BTC", quantity=0.05, avg_price=78000),
    Holding(symbol="ETH", quantity=1.2, avg_price=2600),
    Holding(symbol="RELIANCE", quantity=15, avg_price=2800),
    Holding(symbol="TCS", quantity=10, avg_price=4000),
    Holding(symbol="INFY", quantity=25, avg_price=1820),
]


@router.get("/portfolio", response_model=PortfolioOut)
def portfolio(user: User = Depends(get_current_user)) -> PortfolioOut:
    return PortfolioOut(email=user.email, holdings=DEMO_HOLDINGS)
