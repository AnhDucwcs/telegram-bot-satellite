import aiogram
from aiogram import types, F
from aiogram.filters import Command
from app.services.ai_client import AIClient
from app.services.session_manager import session_manager
from app.models.user_session import UserSession 
from app.core.logger import logger


router = aiogram.Router()

@router.message(Command("start"))
async def cmd_start(message: types.Message):
    await message.answer("Chào mừng bạn đến với bot tính toán lộ trình!\n\n"
                         "Để bắt đầu, hãy nhập lệnh /route để chọn điểm xuất phát và điểm đến của bạn.")

@router.message(Command("route"))
async def cmd_route(message: types.Message):
    session_id = message.chat.id
    session_manager.set_session(session_id, UserSession(session_id=session_id, state="awaiting_start"))
    await message.answer("Bạn đã bắt đầu quá trình chọn lộ trình.\n\n"
                         "Vui lòng gửi vị trí điểm xuất phát của bạn bằng cách sử dụng tính năng chia sẻ vị trí của Telegram.\n\n"
                         "Nếu bạn muốn hủy, hãy nhập /cancel.")
    
@router.message(Command("cancel"))
async def cmd_cancel(message: types.Message):
    session_id = message.chat.id
    if session_manager.has_session(session_id):
        session_manager.clear_session(session_id)
        try:
            session_manager.ensure_cleanup(session_id)
        except Exception as e:
            logger.error(f"Lỗi khi cleanup session sau khi hủy: {e}")
        await message.answer("Đã hủy quá trình chọn lộ trình. Bạn có thể nhập /route để bắt đầu lại.")
    else:
        await message.answer("Bạn chưa bắt đầu quá trình chọn lộ trình. Hãy nhập /route để bắt đầu.")

@router.message(F.location)
async def handle_location(message: types.Message, app_state):
    session_id = message.chat.id
    lock = session_manager.get_or_create_lock(session_id)
    async with lock:
        try:
            session = session_manager.get_session(session_id)
            if not session:
                return message.answer("Vui lòng nhập /route để bắt đầu.")
            if session.state == "awaiting_start":
                session.start_lat = message.location.latitude
                session.start_lng = message.location.longitude
                session.state = "awaiting_destination"
                return await message.answer("Đã nhận điểm xuất phát. Vui lòng gửi vị trí điểm đến.")
            elif session.state == "awaiting_destination":
                end_lat = message.location.latitude
                end_lng = message.location.longitude
                conversation_id = str(message.chat.id)  # Sử dụng chat ID làm conversation ID cho đơn giản
                session.state = "processing"
                await message.answer("Đã nhận điểm đến. Đang tính toán lộ trình...")
                session_manager.bind_conversation(conversation_id, session_id)
                ai_client: AIClient = app_state.ai_client
                route_info = await ai_client.get_route(
                    session.start_lat,
                    session.start_lng,
                    end_lat,
                    end_lng,
                    user_id=str(session_id),
                    conversation_id=conversation_id,
                )
                if route_info and route_info.get("status") == "accepted":
                    await message.answer("Yêu cầu đã được tiếp nhận. Mình sẽ gửi kết quả ngay khi tính xong.")
                else:
                    await message.answer("Không thể gửi yêu cầu tính lộ trình lúc này. Vui lòng thử lại.")
                session_manager.clear_session(session_id)
                return
        except Exception as e:
            logger.error(f"Lỗi khi xử lý lộ trình: {e}")
            await message.answer(f"Đã xảy ra lỗi khi tính toán lộ trình, vui lòng nhập /route để thử lại.")
        finally:
            session_manager.ensure_cleanup(session_id)
            logger.info(f"Đã reset session cho user {message.chat.id}")

@router.message()
async def handle_non_location(message: types.Message):
    """
    Xử lý các tin nhắn không phải là vị trí. Nếu người dùng đang trong quá trình chọn điểm xuất phát hoặc điểm đến, nhắc họ gửi vị trí.
     Nếu không, có thể bỏ qua hoặc trả lời mặc định.
    """
    
    session_id = message.chat.id
    if not session_manager.has_session(session_id):
        return  # Nếu chưa có session, không cần phản hồi gì
    lock = session_manager.get_or_create_lock(session_id)
    async with lock:
        try:
            session = session_manager.get_session(session_id)
            if not session:
                return
            if session.state == "awaiting_start":
                await message.answer("Hệ thống đang chờ **vị trí xuất phát** của bạn.\n\n"
                                     " Vui lòng sử dụng tính năng chia sẻ vị trí để chọn vị trí xuất phát.\n\n"
                                     "Nếu bạn muốn hủy, hãy nhập /cancel.", parse_mode="HTML")
            elif session.state == "awaiting_destination":
                await message.answer("Hệ thống đang chờ **vị trí điểm đến** của bạn.\n\n"
                                     " Vui lòng sử dụng tính năng chia sẻ vị trí để chọn điểm đến.\n\n"
                                     "Nếu bạn muốn hủy, hãy nhập /cancel.", parse_mode="HTML")
            elif session.state == "processing":
                await message.answer("Hệ thống đang tính toán lộ trình của bạn, vui lòng chờ trong giây lát...")
        except Exception as e:
            logger.error(f"Lỗi khi xử lý tin nhắn không phải location: {e}")
    